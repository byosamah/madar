import type { KeyboardEvent } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useLang } from '../../app/lang';
import type { Stage } from '../../api/contract/entities';
import type { ProjectSummary, TaskRow } from '../../api/contract/views';
import { AvatarStack } from '../../components/AvatarStack';
import { MadarMark } from '../../components/MadarMark';
import { ProjectTile } from '../../components/ProjectTile';
import { StatusSign, signOfProject, type SignState } from '../../components/StatusSign';
import { formatDay, todayISO, type Lang } from '../../lib/dates';
import { dueText, dueWord } from '../../lib/due';
import type { SpaceNode as Placed } from './spaceTree';

/** What one card shows. The screen fills it from the lists it reads. A card with no next level has `expandable` false. */
export type SpaceCardData = {
  id: string;
  kind: Placed['kind'];
  open: boolean;
  faded: boolean;
  expandable: boolean;
  onToggle: (id: string) => void;
  summary?: ProjectSummary;
  stage?: Stage;
  current?: boolean;
  row?: TaskRow;
};

export type SpaceFlowNode = Node<SpaceCardData, 'space'>;

// The handles are not drawn: the lines of the tree join the cards at their edges.
const HIDDEN_HANDLE = { opacity: 0 } as const;
const CARD = 'surface rounded-card w-60 p-3 text-start transition-opacity duration-200 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link';

/** The word of a project's sign: its health while it is active, else its state (the same words as the Projects list). */
function signWord(state: SignState, staleDays: number | null, t: TFunction): string {
  if (state === 'on_track' || state === 'at_risk' || state === 'late') return t(`health.${state}`);
  if (state === 'stale') return t('status.stale', { count: staleDays ?? 0 });
  if (state === 'paused') return t('status.on_hold');
  return t(`status.${state}`);
}

/** A stage's span: both dates, else the one date that it has, else "No date". */
function datesOf(stage: Stage, t: TFunction, lang: Lang): string {
  if (stage.startDate && stage.endDate) return t('space.dates', { start: formatDay(stage.startDate, lang), end: formatDay(stage.endDate, lang) });
  const single = stage.startDate ?? stage.endDate;
  return single ? formatDay(single, lang) : t('space.noDate');
}

/** Enter opens or closes a card that has a next level. An Enter on a button inside the card only presses that button. */
function toggleOnEnter(event: KeyboardEvent<HTMLDivElement>, data: SpaceCardData) {
  if (event.key !== 'Enter' || event.target !== event.currentTarget || !data.expandable) return;
  event.preventDefault();
  data.onToggle(data.id);
}

/** The attributes that make a card a button when it has a next level, and that carry its state. */
function levelProps(data: SpaceCardData) {
  const activate = () => {
    if (data.expandable) data.onToggle(data.id);
  };
  return {
    'data-kind': data.kind,
    'data-open': data.open,
    'data-faded': data.faded,
    role: data.expandable ? 'button' : undefined,
    tabIndex: data.expandable ? 0 : undefined,
    'aria-expanded': data.expandable ? data.open : undefined,
    onClick: activate,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => toggleOnEnter(event, data),
    className: `${CARD} ${data.expandable ? 'cursor-pointer' : ''} ${data.faded ? 'opacity-40' : ''}`,
  };
}

function ProjectCard({ data }: { data: SpaceCardData }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const summary = data.summary;
  if (!summary) return null;
  const state = signOfProject({ project: summary.project, health: summary.health, staleDays: summary.staleDays });
  const word = signWord(state, summary.staleDays, t);
  return (
    <div {...levelProps(data)}>
      <div className="flex items-center gap-2.5">
        <ProjectTile id={summary.project.id} mark={summary.project.mark} size={32} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <bdi dir="auto" className="truncate text-subheadline font-semibold text-ink">{summary.project.name}</bdi>
          {/* On track is the normal state, so its word stays for a screen reader only. */}
          <StatusSign state={state}>{state === 'on_track' ? <span className="sr-only">{word}</span> : word}</StatusSign>
        </div>
      </div>
      <div className="mt-2.5 flex min-w-0 flex-col">
        <span className="text-caption text-ink-2">{t('space.currentStage')}</span>
        <bdi dir="auto" className="truncate text-footnote text-ink">{summary.currentStage.name}</bdi>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          navigate({ pathname: `/projects/${summary.project.id}` });
        }}
        className="mt-2 text-footnote font-semibold text-link enabled:hover:underline"
      >
        {t('space.openProject')}
      </button>
    </div>
  );
}

function StageCard({ data }: { data: SpaceCardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const stage = data.stage;
  if (!stage) return null;
  return (
    <div {...levelProps(data)}>
      {data.current && <span className="text-caption font-semibold text-ink">{t('space.currentStage')}</span>}
      <bdi dir="auto" className="block truncate text-subheadline font-semibold text-ink">{stage.name}</bdi>
      <span className="block text-footnote text-ink-2">{datesOf(stage, t, lang)}</span>
    </div>
  );
}

function TaskCard({ data }: { data: SpaceCardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const row = data.row;
  if (!row) return null;
  const today = todayISO();
  const word = row.task.dueDate ? dueWord(row.task.dueDate, today, row.task.status) : null;
  const due = word && row.task.dueDate ? dueText(word, t, lang, row.task.dueDate) : t('space.noDate');
  return (
    <div {...levelProps(data)}>
      <bdi dir="auto" className="block truncate text-footnote font-semibold text-ink">{row.task.title}</bdi>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-caption text-ink-2">{due}</span>
        {/* The lead first, then the helpers: three pictures at most, then "+N" (the same rule as the Projects list). */}
        <AvatarStack leader={row.owner} team={row.helpers} max={row.owner ? 2 : 3} size={22} leaderSize={26} />
      </div>
    </div>
  );
}

function OfficeCard() {
  const { t } = useTranslation();
  return (
    <div data-kind="office" className={`${CARD} flex items-center gap-2.5`}>
      <MadarMark size={34} />
      <span className="text-subheadline font-semibold text-ink">{t('space.office')}</span>
    </div>
  );
}

/** The card of one node of the map. React Flow calls it with the node's data and the sides of its handles. */
export function SpaceCard({ data, sourcePosition, targetPosition }: NodeProps<SpaceFlowNode>) {
  const body = data.kind === 'office'
    ? <OfficeCard />
    : data.kind === 'project'
      ? <ProjectCard data={data} />
      : data.kind === 'stage'
        ? <StageCard data={data} />
        : <TaskCard data={data} />;
  return (
    <>
      <Handle type="target" position={targetPosition ?? Position.Left} isConnectable={false} style={HIDDEN_HANDLE} />
      {body}
      <Handle type="source" position={sourcePosition ?? Position.Right} isConnectable={false} style={HIDDEN_HANDLE} />
    </>
  );
}

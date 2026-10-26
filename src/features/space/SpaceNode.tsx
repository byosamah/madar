import { memo, type FocusEvent, type KeyboardEvent } from 'react';
import { Handle, Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useLang } from '../../app/lang';
import { useSubCompany } from '../../app/subCompanies';
import type { ChecklistItem, Deadline, Stage } from '../../api/contract/entities';
import type { ProjectSummary, TaskRow } from '../../api/contract/views';
import { AvatarStack } from '../../components/AvatarStack';
import { IconButton } from '../../components/IconButton';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { ArrowUpRightIcon } from '../../components/icons/animated/arrow-up-right';
import { MadarMark } from '../../components/MadarMark';
import { SubCompanyLogo } from '../../components/SubCompanyLogo';
import { ProjectTile } from '../../components/ProjectTile';
import { StatusSign, signOfProject, type SignState } from '../../components/StatusSign';
import { formatDay, todayISO, type Lang } from '../../lib/dates';
import { counted } from '../../lib/grammar';
import { dueText, dueWord } from '../../lib/due';
import { CARD_HEIGHT, type SpaceKind } from './spaceTree';
import { useProjectName } from '../../app/projectName';

/** What one card shows. The screen fills it from the lists it reads. A card with no next level has `expandable` false. */
export type SpaceCardData = {
  id: string;
  kind: SpaceKind;
  open: boolean;
  faded: boolean;
  expandable: boolean;
  onToggle: (id: string) => void;
  /** A press on a task card opens its panel over the map (PRJ-08). */
  onOpenTask: (taskId: string, projectId: string | null) => void;
  /** The three facts of a project card: its stages, its open tasks, and the open tasks past due. */
  facts?: { stages: number; tasks: number; late: number };
  summary?: ProjectSummary;
  stage?: Stage;
  current?: boolean;
  row?: TaskRow;
  /** A sub-company card: its id (null for "No sub-company") and its two facts. */
  subId?: string | null;
  subFacts?: { projects: number; late: number };
  /** A deadline card. */
  deadline?: Deadline;
  /** A checklist card: the item of the to-do in `row`. */
  item?: ChecklistItem;
  /** A "more" card: the items past the cap of the to-do in `row`. */
  moreCount?: number;
};

export type SpaceFlowNode = Node<SpaceCardData, 'space'>;

// The handles are not drawn: the lines of the tree join the cards at their edges.
const HIDDEN_HANDLE = { opacity: 0 } as const;
// React Flow gives a node of a read-only map no pointer events, so a card asks for them again: a mouse press or a tap must open it.
const CARD = 'pointer-events-auto surface rounded-card w-72 p-3 text-start transition-opacity duration-200 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link';
// A card is 288 px wide (w-72). Its middle sits 144 px along from its start corner, and half its height down.
const CARD_CENTER_X = 144;

/** The two parts of the map that a card uses to move the view. */
type MapView = Pick<ReturnType<typeof useReactFlow>, 'setCenter' | 'getZoom'>;

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

/** Enter or Space opens or closes a card that has a next level. A key on a button inside the card only presses that button. */
function toggleOnKey(event: KeyboardEvent<HTMLDivElement>, data: SpaceCardData) {
  if ((event.key !== 'Enter' && event.key !== ' ') || event.target !== event.currentTarget || !data.expandable) return;
  event.preventDefault();
  data.onToggle(data.id);
}

/** The class of a card: the surface, a pointer when it has a next level or a panel, and a fade when the focus leaves it out. */
function cardClass(data: SpaceCardData): string {
  return `${CARD} ${data.expandable || data.kind === 'task' ? 'cursor-pointer' : ''} ${data.faded ? 'opacity-40' : ''}`;
}

/** A mouse click on a card opens or closes it, when it has a next level. */
function clickToggles(data: SpaceCardData) {
  return () => {
    if (data.expandable) data.onToggle(data.id);
  };
}

/**
 * A keyboard user focuses a card outside the map. The map then moves to show the card. A mouse click does not move the map.
 */
function revealFocused(event: FocusEvent<HTMLDivElement>, card: { x: number; y: number; height: number }, view: MapView) {
  const target = event.target as HTMLElement;
  if (!target.matches(':focus-visible')) return;
  const map = event.currentTarget.closest('.react-flow');
  if (!map) return;
  const mapBox = map.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  const inside = box.left >= mapBox.left && box.right <= mapBox.right && box.top >= mapBox.top && box.bottom <= mapBox.bottom;
  if (inside) return;
  void view.setCenter(card.x + CARD_CENTER_X, card.y + card.height / 2, { zoom: view.getZoom(), duration: 0 });
}

/** The attributes that make a stage or a task a button when it has a next level, and that carry its state. */
function levelProps(data: SpaceCardData) {
  return {
    'data-kind': data.kind,
    'data-open': data.open,
    'data-faded': data.faded,
    role: data.expandable ? 'button' : undefined,
    tabIndex: data.expandable ? 0 : undefined,
    'aria-expanded': data.expandable ? data.open : undefined,
    onClick: clickToggles(data),
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => toggleOnKey(event, data),
    className: cardClass(data),
  };
}

/** The facts under the stage of a project card: "7 stages · 12 open tasks · 2 past due". The late count shows only above 0. */
function Facts({ facts }: { facts: NonNullable<SpaceCardData['facts']> }) {
  const { t } = useTranslation();
  return (
    <span className="mt-1.5 flex items-center gap-x-1.5 whitespace-nowrap text-caption text-ink-2" data-facts>
      <span>{counted(t, 'space.stagesCount', facts.stages)}</span>
      <span aria-hidden>·</span>
      <span>{counted(t, 'space.tasksCount', facts.tasks)}</span>
      {facts.late > 0 && (
        <>
          <span aria-hidden>·</span>
          <span className="font-semibold text-late">{counted(t, 'space.lateCount', facts.late)}</span>
        </>
      )}
    </span>
  );
}

function ProjectCard({ data }: { data: SpaceCardData }) {
  const { t } = useTranslation();
  const projectName = useProjectName();
  const navigate = useNavigate();
  const summary = data.summary;
  if (!summary) return null;
  const state = signOfProject({ project: summary.project, health: summary.health, staleDays: summary.staleDays });
  const word = signWord(state, summary.staleDays, t);
  // The card is not a button: the "Open project" button sits at its end corner, and a button cannot hold a button. The body is the
  // button that opens and closes the card. A press on the card margin reaches the card, which does the same (PRJ-08).
  return (
    <div data-kind={data.kind} data-open={data.open} data-faded={data.faded} onClick={clickToggles(data)} className={`${cardClass(data)} relative`}>
      <button type="button" aria-expanded={data.expandable ? data.open : undefined} className="block w-full min-w-0 text-start">
        {/* The first row leaves room for the Open project button at the end of the card. */}
        <span className="flex items-center gap-2.5 pe-9">
          <ProjectTile id={summary.project.id} mark={summary.project.mark} shape={summary.project.shape} size={32} subCompanyId={summary.subCompanyId} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <bdi dir="auto" className="truncate text-subheadline font-semibold text-ink">{projectName(summary.project)}</bdi>
            {/* On track is the normal state, so its word stays for a screen reader only. */}
            <StatusSign state={state}>{state === 'on_track' ? <span className="sr-only">{word}</span> : word}</StatusSign>
          </span>
        </span>
        <span className="mt-2.5 flex min-w-0 flex-col">
          <span className="text-caption text-ink-2">{t('space.currentStage')}</span>
          <bdi dir="auto" className="truncate text-footnote text-ink">{summary.currentStage.name}</bdi>
        </span>
        {data.facts && <Facts facts={data.facts} />}
      </button>
      <IconButton
        label={t('space.openProject')}
        className="absolute end-1 top-1 text-link"
        onClick={(event) => {
          event.stopPropagation();
          navigate({ pathname: `/projects/${summary.project.id}` });
        }}
      >
        <AnimatedIcon icon={ArrowUpRightIcon} size={18} aria-hidden className="rtl:-scale-x-100" />
      </IconButton>
    </div>
  );
}

/** A card of a sub-company: its logo, its name, how many projects it has and how many open to-dos are past due. */
function SubCompanyCard({ data }: { data: SpaceCardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const sub = useSubCompany(data.subId);
  const facts = data.subFacts;
  const name = data.subId === null || data.subId === undefined ? t('subCompanies.none') : sub ? (lang === 'ar' ? sub.nameAr : sub.name) : '';
  return (
    <div {...levelProps(data)}>
      <span className="flex items-center gap-2.5">
        {data.subId ? <SubCompanyLogo subCompanyId={data.subId} size={32} /> : <span aria-hidden className="size-8 shrink-0 rounded-full bg-fill" />}
        <bdi dir="auto" className="min-w-0 truncate text-subheadline font-semibold text-ink">{name}</bdi>
      </span>
      {facts && (
        <span className="mt-1.5 flex items-center gap-x-1.5 whitespace-nowrap text-caption text-ink-2" data-facts>
          <span>{counted(t, 'subCompanies.projectCount', facts.projects)}</span>
          {facts.late > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="font-semibold text-late">{counted(t, 'space.lateCount', facts.late)}</span>
            </>
          )}
        </span>
      )}
    </div>
  );
}

/** The class of a card that has no next level and no panel: the surface, and a fade when the focus leaves it out. */
const quietClass = (data: SpaceCardData) => `${CARD} flex items-center gap-2.5 ${data.faded ? 'opacity-40' : ''}`;

/** A deadline of a project: a small diamond, its name and its date. The word "Deadline" stays for a screen reader. */
function DeadlineCard({ data }: { data: SpaceCardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const deadline = data.deadline;
  if (!deadline) return null;
  return (
    <div data-kind={data.kind} data-open={data.open} data-faded={data.faded} className={quietClass(data)}>
      <svg viewBox="0 0 12 12" width="14" height="14" aria-hidden className="shrink-0 text-link"><path d="M6 0l6 6-6 6-6-6z" fill="currentColor" /></svg>
      <span className="flex min-w-0 flex-col">
        <bdi dir="auto" className="block truncate text-footnote font-semibold text-ink">{deadline.name}</bdi>
        <span className="text-caption text-ink-2">
          <span className="sr-only">{t('space.deadline')}</span>
          <span>{formatDay(deadline.date, lang)}</span>
        </span>
      </span>
    </div>
  );
}

/** One item of the checklist of a to-do: a tick box and its text. */
function CheckCard({ data }: { data: SpaceCardData }) {
  const { t } = useTranslation();
  const item = data.item;
  if (!item) return null;
  return (
    <div data-kind={data.kind} data-open={data.open} data-faded={data.faded} className={quietClass(data)}>
      <span aria-hidden className={`grid size-4 shrink-0 place-items-center rounded border ${item.done ? 'border-done bg-done text-white' : 'border-ink-2/60'}`}>
        {item.done && <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-5" /></svg>}
      </span>
      <bdi dir="auto" className={`min-w-0 truncate text-footnote ${item.done ? 'text-ink-2 line-through' : 'text-ink'}`}>{item.text}</bdi>
      <span className="sr-only">{item.done ? t('space.itemDone') : t('space.itemOpen')}</span>
    </div>
  );
}

/** The card for the checklist items past the cap. A press opens the to-do, where the person reads the whole checklist. */
function MoreCard({ data }: { data: SpaceCardData }) {
  const { t } = useTranslation();
  const row = data.row;
  if (!row || !data.moreCount) return null;
  const open = () => data.onOpenTask(row.task.id, row.task.projectId);
  return (
    <div
      data-kind={data.kind}
      data-open={data.open}
      data-faded={data.faded}
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      onClick={open}
      onKeyDown={(event) => {
        if ((event.key !== 'Enter' && event.key !== ' ') || event.target !== event.currentTarget) return;
        event.preventDefault();
        open();
      }}
      className={`${quietClass(data)} cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link`}
    >
      <span className="text-footnote font-semibold text-link">{counted(t, 'space.moreItems', data.moreCount)}</span>
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
      {/* The current stage carries its mark on the title row, so every stage card has the same height. */}
      <span className="flex items-center justify-between gap-2">
        <bdi dir="auto" className="block min-w-0 truncate text-subheadline font-semibold text-ink">{stage.name}</bdi>
        {data.current && <span className="shrink-0 rounded-full bg-fill px-2 py-0.5 text-caption font-semibold text-ink">{t('space.currentStage')}</span>}
      </span>
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
  // A press opens the task panel over the map (PRJ-08). The card is a button for a keyboard user too.
  const open = () => data.onOpenTask(row.task.id, row.task.projectId);
  return (
    <div
      {...levelProps(data)}
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      onClick={open}
      onKeyDown={(event) => {
        if ((event.key !== 'Enter' && event.key !== ' ') || event.target !== event.currentTarget) return;
        event.preventDefault();
        open();
      }}
    >
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
function cardBody(data: SpaceCardData) {
  switch (data.kind) {
    case 'office': return <OfficeCard />;
    case 'subcompany': return <SubCompanyCard data={data} />;
    case 'project': return <ProjectCard data={data} />;
    case 'stage': return <StageCard data={data} />;
    case 'deadline': return <DeadlineCard data={data} />;
    case 'check': return <CheckCard data={data} />;
    case 'more': return <MoreCard data={data} />;
    default: return <TaskCard data={data} />;
  }
}

/**
 * The card is a memo: the screen keeps the data of a card that a tap did not touch, so React Flow draws again only the cards that
 * changed (fbk_055, the speed rule).
 */
export const SpaceCard = memo(function SpaceCard({ data, sourcePosition, targetPosition, positionAbsoluteX, positionAbsoluteY }: NodeProps<SpaceFlowNode>) {
  const lang = useLang();
  const view = useReactFlow();
  const body = cardBody(data);
  return (
    <>
      <Handle type="target" position={targetPosition ?? Position.Left} isConnectable={false} style={HIDDEN_HANDLE} />
      {/* React Flow sets the map to left to right, so the card sets its own direction from the language. */}
      <div dir={lang === 'ar' ? 'rtl' : 'ltr'} onFocus={(event) => revealFocused(event, { x: positionAbsoluteX, y: positionAbsoluteY, height: CARD_HEIGHT[data.kind] }, view)}>{body}</div>
      <Handle type="source" position={sourcePosition ?? Position.Right} isConnectable={false} style={HIDDEN_HANDLE} />
    </>
  );
});

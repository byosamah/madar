import { useTranslation } from 'react-i18next';
import type { SyncChoices, SyncDiff } from '../../../api/templateSync';
import { useLang } from '../../../app/lang';
import { counted } from '../../../lib/grammar';
import { listFormat } from '../../../lib/dates';

/** The kinds of change that the Admin picks, in the order of the cards. */
export const KINDS = ['add', 'bringBack', 'removed', 'text', 'dates', 'leads', 'closed', 'stages'] as const;
export type Kind = (typeof KINDS)[number];

/** The kinds that count tasks. The other kinds count items (stages or tasks), or stages. */
const TASK_KINDS: readonly Kind[] = ['removed', 'text', 'dates', 'leads', 'closed'];

/** A linked project and what a template update would change in it. */
export type SyncRow = { project: { id: string; name: string }; diff: SyncDiff };

/**
 * The picks at the start. Each change is on, except the two kinds that keep the team's own choice: a dropped item stays out,
 * and a done task keeps its place.
 */
export const DEFAULT_CHOICES: SyncChoices = {
  add: true, bringBack: false, removed: 'keep', text: true, dates: true, leads: true, closed: 'leave', stages: true,
};

const TITLE_KEY: Record<Kind, string> = {
  add: 'projectTemplates.update.kind.add',
  bringBack: 'projectTemplates.update.kind.bringBack',
  removed: 'projectTemplates.update.kind.removed',
  text: 'projectTemplates.update.kind.text',
  dates: 'projectTemplates.update.kind.dates',
  leads: 'projectTemplates.update.kind.leads',
  closed: 'projectTemplates.update.kind.closed',
  stages: 'projectTemplates.update.kind.stages',
};

/** The word that counts the items of one kind: stages, tasks, or the items of both (a new part can be a stage or a task). */
function nounKey(kind: Kind): string {
  if (kind === 'stages') return 'projectTemplates.stageCount';
  if (TASK_KINDS.includes(kind)) return 'projectTemplates.taskCount';
  return 'projectTemplates.update.itemCount';
}

/** The number of items of one kind in the diff of one project. */
export function itemsOf(diff: SyncDiff, kind: Kind): number {
  switch (kind) {
    case 'add': return diff.add.length;
    case 'bringBack': return diff.dropped.length;
    case 'removed': return diff.removed.length;
    case 'text': return diff.text.length;
    case 'dates': return diff.dates.length;
    case 'leads': return diff.leads.length;
    case 'closed': return diff.closed.length;
    case 'stages': return diff.stages.length;
  }
}

/** The kinds that one project changes with these picks, in card order. */
export function changesOf(diff: SyncDiff, choices: SyncChoices): Kind[] {
  const on: Record<Kind, boolean> = {
    add: choices.add && diff.add.length > 0,
    bringBack: choices.bringBack && diff.dropped.length > 0,
    removed: choices.removed === 'delete_unstarted' && diff.removed.length > 0,
    text: choices.text && diff.text.length > 0,
    dates: choices.dates && diff.dates.length > 0,
    leads: choices.leads && diff.leads.length > 0,
    closed: choices.closed === 'text_only' && diff.closed.length > 0,
    stages: choices.stages && diff.stages.length > 0,
  };
  return KINDS.filter((kind) => on[kind]);
}

type BoolKind = 'add' | 'text' | 'dates' | 'leads' | 'stages';

/** The two answers of a card with a yes and a no. */
function yesNo(kind: BoolKind, choices: SyncChoices) {
  const on = choices[kind];
  return [
    { key: 'projectTemplates.update.choice.yes', checked: on, pick: { [kind]: true } as Partial<SyncChoices> },
    { key: 'projectTemplates.update.choice.no', checked: !on, pick: { [kind]: false } as Partial<SyncChoices> },
  ];
}

/** The two answers of a card, as word keys, with the pick that each answer makes. */
function answersOf(kind: Kind, choices: SyncChoices) {
  const C = 'projectTemplates.update.choice.';
  switch (kind) {
    case 'bringBack': return [
      { key: `${C}bringBack`, checked: choices.bringBack, pick: { bringBack: true } },
      { key: `${C}leaveOut`, checked: !choices.bringBack, pick: { bringBack: false } },
    ];
    case 'removed': return [
      { key: `${C}keepTasks`, checked: choices.removed === 'keep', pick: { removed: 'keep' as const } },
      { key: `${C}deleteUnstarted`, checked: choices.removed === 'delete_unstarted', pick: { removed: 'delete_unstarted' as const } },
    ];
    case 'closed': return [
      { key: `${C}textOnly`, checked: choices.closed === 'text_only', pick: { closed: 'text_only' as const } },
      { key: `${C}leaveClosed`, checked: choices.closed === 'leave', pick: { closed: 'leave' as const } },
    ];
    default: return yesNo(kind, choices);
  }
}

/** One card: a kind of change, its count over the projects, and the Admin's pick (two answers). */
export function ChangeCard({ kind, rows, choices, onChoose }: {
  kind: Kind;
  rows: SyncRow[];
  choices: SyncChoices;
  onChoose: (pick: Partial<SyncChoices>) => void;
}) {
  const { t } = useTranslation();
  const items = rows.reduce((sum, row) => sum + itemsOf(row.diff, kind), 0);
  const projects = rows.filter((row) => itemsOf(row.diff, kind) > 0).length;
  const line = t('projectTemplates.update.countLine', {
    items: counted(t, nounKey(kind), items),
    projects: counted(t, 'projectTemplates.update.projectCount', projects),
  });
  return (
    <fieldset className="surface flex flex-col gap-2 rounded-card p-4">
      <legend className="text-headline px-1">{t(TITLE_KEY[kind])}</legend>
      <p className="text-subheadline text-ink-2">{line}</p>
      {answersOf(kind, choices).map((answer) => (
        <label key={answer.key} className="flex min-h-11 items-center gap-3 text-body text-ink">
          <input
            type="radio"
            name={`update-change-${kind}`}
            checked={answer.checked}
            onChange={() => onChoose(answer.pick)}
            className="size-5 accent-[var(--sig-from)]"
          />
          {t(answer.key)}
        </label>
      ))}
    </fieldset>
  );
}

/** One project on the summary step: its name, and the kinds that it changes (or "Nothing changes."). */
export function ChangeSummary({ row, choices }: { row: SyncRow; choices: SyncChoices }) {
  const { t } = useTranslation();
  const lang = useLang();
  const kinds = changesOf(row.diff, choices);
  return (
    <li className="flex flex-col gap-1 py-2">
      <bdi className="font-semibold text-ink">{row.project.name}</bdi>
      <span className="text-footnote text-ink-2">
        {kinds.length > 0 ? listFormat(lang).format(kinds.map((kind) => t(TITLE_KEY[kind]))) : t('projectTemplates.update.nothing')}
      </span>
    </li>
  );
}

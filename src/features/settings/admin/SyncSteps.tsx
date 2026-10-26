import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { ItemRef, PartRef, Span, SyncChoices, SyncDiff } from '../../../api/templateSync';
import { useLang } from '../../../app/lang';
import { counted } from '../../../lib/grammar';
import { formatDay, listFormat, type Lang } from '../../../lib/dates';
import { useProjectName } from '../../../app/projectName';

/** The kinds of change that the Admin picks, in the order of the cards. */
export const KINDS = ['add', 'bringBack', 'removed', 'text', 'dates', 'leads', 'closed', 'stages', 'edited'] as const;
export type Kind = (typeof KINDS)[number];

/** The kinds that count tasks. The other kinds count items (stages or tasks), or stages. */
const TASK_KINDS: readonly Kind[] = ['removed', 'text', 'dates', 'leads', 'closed'];

/** A linked project and what a template update would change in it. */
export type SyncRow = { project: { id: string; name: string }; diff: SyncDiff };

/**
 * The picks at the start. Each change is on, except the kinds that keep the team's own choice: a dropped item stays out, a done
 * task keeps its place, and an item that the team edited keeps the team's version (ADM-01).
 */
export const DEFAULT_CHOICES: SyncChoices = {
  add: true, bringBack: false, removed: 'keep', text: true, dates: true, leads: true, closed: 'leave', stages: true, edited: 'keep',
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
  edited: 'projectTemplates.update.kind.edited',
};

/** The word that counts the items of one kind: stages, tasks, or the items of both (a new part can be a stage or a task). */
function nounKey(kind: Kind): string {
  if (kind === 'stages') return 'projectTemplates.stageCount';
  if (TASK_KINDS.includes(kind)) return 'projectTemplates.taskCount';
  return 'projectTemplates.update.itemCount';
}

/** The items of one kind in the diff of one project. */
function listOf(diff: SyncDiff, kind: Kind): (PartRef | ItemRef)[] {
  switch (kind) {
    case 'add': return diff.add;
    case 'bringBack': return diff.dropped;
    case 'removed': return diff.removed;
    case 'text': return diff.text;
    case 'dates': return diff.dates;
    case 'leads': return diff.leads;
    case 'closed': return diff.closed;
    case 'stages': return diff.stages;
    case 'edited': return diff.edited;
  }
}

/** The number of items of one kind in the diff of one project. */
export function itemsOf(diff: SyncDiff, kind: Kind): number {
  return listOf(diff, kind).length;
}

/** True when the tick of a kind is on. A kind with two answers is on when its answer is the one that changes the project. */
export function tickOf(kind: Kind, choices: SyncChoices): boolean {
  switch (kind) {
    case 'removed': return choices.removed === 'delete_unstarted';
    case 'closed': return choices.closed === 'text_only';
    case 'edited': return choices.edited === 'use_template';
    default: return choices[kind];
  }
}

/** The pick that a tick makes. */
export function pickOf(kind: Kind, on: boolean): Partial<SyncChoices> {
  switch (kind) {
    case 'removed': return { removed: on ? 'delete_unstarted' : 'keep' };
    case 'closed': return { closed: on ? 'text_only' : 'leave' };
    case 'edited': return { edited: on ? 'use_template' : 'keep' };
    default: return { [kind]: on };
  }
}

/** The kinds that one project changes with these picks, in card order. */
export function changesOf(diff: SyncDiff, choices: SyncChoices): Kind[] {
  return KINDS.filter((kind) => tickOf(kind, choices) && itemsOf(diff, kind) > 0);
}

/** True when the picks move a date in this project: the planned dates, or an edited item that takes the dates of the template. */
export function movesDates(diff: SyncDiff, choices: SyncChoices): boolean {
  return (choices.dates && diff.dates.length > 0) || (choices.edited === 'use_template' && diff.edited.some((item) => item.dates !== undefined));
}

/** True when the diff of a project names nothing at all: the project already matches the template. */
export function matchesTemplate(diff: SyncDiff): boolean {
  return KINDS.every((kind) => itemsOf(diff, kind) === 0);
}

/** How many lines a card shows before "Show all". */
const LINES = 5;

type LineContext = { t: TFunction; lang: Lang; nameOf: (userId: string | null) => string };

const rangeOf = (span: Span, { t, lang }: LineContext): string => {
  if (span.start && span.due && span.start !== span.due) {
    return t('projectTemplates.update.line.range', { start: formatDay(span.start, lang), due: formatDay(span.due, lang) });
  }
  const day = span.due ?? span.start;
  return day ? formatDay(day, lang) : t('projectTemplates.update.line.noDate');
};

/** One line for an item: what it is, and what the change does to it. It names the task, so the Admin decides with the facts. */
function lineOf(kind: Kind, item: PartRef | ItemRef, ctx: LineContext): string {
  const { t, lang } = ctx;
  const K = 'projectTemplates.update.line.';
  if (!('itemId' in item)) return t(`${K}part`, { title: item.title });
  if (kind === 'dates' && item.dates) return t(`${K}change`, { title: item.title, from: rangeOf(item.dates.from, ctx), to: rangeOf(item.dates.to, ctx) });
  if (kind === 'leads' && item.lead) {
    return t(`${K}change`, { title: item.title, from: ctx.nameOf(item.lead.from), to: ctx.nameOf(item.lead.to) });
  }
  if (kind === 'edited') {
    const what = [
      ...(item.newTitle !== undefined ? [t(`${K}whatTitle`, { newTitle: item.newTitle })] : []),
      ...(item.description ? [t(`${K}whatDescription`)] : []),
      ...(item.dates ? [t(`${K}whatDates`, { to: rangeOf(item.dates.to, ctx) })] : []),
    ];
    return t(`${K}edited`, { title: item.title, what: listFormat(lang).format(what) });
  }
  if (item.newTitle !== undefined && item.description) return t(`${K}textBoth`, { title: item.title, newTitle: item.newTitle });
  if (item.newTitle !== undefined) return t(`${K}text`, { title: item.title, newTitle: item.newTitle });
  if (item.description) return t(`${K}description`, { title: item.title });
  return t(`${K}part`, { title: item.title });
}

/**
 * One card of the review: a kind of change with one tick, and the lines that name each task with the old and the new value
 * (ADM-04). A card with many lines shows the first five and a "Show all" button. With more than one project, the lines sit under
 * the name of their project.
 */
export function ChangeCard({ kind, rows, choices, onChoose, nameOf }: {
  kind: Kind;
  rows: SyncRow[];
  choices: SyncChoices;
  onChoose: (pick: Partial<SyncChoices>) => void;
  nameOf: (userId: string | null) => string;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const projectName = useProjectName();
  const [all, setAll] = useState(false);
  const withItems = rows.filter((row) => itemsOf(row.diff, kind) > 0);
  const items = withItems.reduce((sum, row) => sum + itemsOf(row.diff, kind), 0);
  const line = t('projectTemplates.update.countLine', {
    items: counted(t, nounKey(kind), items),
    projects: counted(t, 'projectTemplates.update.projectCount', withItems.length),
  });
  const ctx: LineContext = { t, lang, nameOf };
  const groups = withItems.map((row) => ({ row, lines: listOf(row.diff, kind).map((item) => lineOf(kind, item, ctx)) }));
  const shown = all ? Infinity : LINES;
  let used = 0;
  const id = `update-kind-${kind}`;
  return (
    <section aria-labelledby={id} className="surface flex flex-col gap-2 rounded-card p-4">
      <label className="flex min-h-11 items-start gap-3 text-body text-ink">
        <input
          type="checkbox"
          checked={tickOf(kind, choices)}
          onChange={(event) => onChoose(pickOf(kind, event.target.checked))}
          className="mt-0.5 size-5 shrink-0 accent-[var(--sig-from)]"
        />
        <span className="flex min-w-0 flex-col">
          <span id={id} className="text-headline">{t(TITLE_KEY[kind])}</span>
          <span className="text-subheadline text-ink-2">{t(`projectTemplates.update.tick.${kind}`)}</span>
        </span>
      </label>
      <p className="ps-8 text-footnote text-ink-2">{line}</p>
      {kind === 'edited' && <p className="ps-8 text-footnote text-ink-2">{t('projectTemplates.update.editedHint')}</p>}
      <ul className="flex flex-col gap-2 ps-8">
        {groups.map(({ row, lines }) => {
          const visible = lines.filter(() => (used += 1) <= shown);
          if (visible.length === 0) return null;
          return (
            <li key={row.project.id} className="flex flex-col gap-0.5">
              {rows.length > 1 && <bdi className="text-footnote font-semibold text-ink">{projectName(row.project)}</bdi>}
              <ul className="flex flex-col gap-0.5">
                {visible.map((text, index) => <li key={index} dir="auto" className="text-footnote text-ink-2">{text}</li>)}
              </ul>
            </li>
          );
        })}
      </ul>
      {items > LINES && (
        <button type="button" onClick={() => setAll((on) => !on)} className="pressable min-h-11 self-start rounded-xl px-2 text-footnote font-medium text-ink-2 hover:bg-fill">
          {all ? t('projectTemplates.update.line.showLess') : t('projectTemplates.update.line.showAll', { n: items })}
        </button>
      )}
    </section>
  );
}

import { useCallback, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLang } from '../../app/lang';
import data from './data.generated.json';
import { pushRecent, readRecent, readTone, writeTone, type Tone } from './recent';
import { Cell } from './EmojiCell';
import { EmojiGroup } from './EmojiGroup';
import { useStaged } from '../../app/useStaged';
import { searchEmoji, type EmojiItem } from './search';

/**
 * The emoji panel (chat presence design D, track emoji E2): a search field, the row of the 8 groups, Recent, then the groups, each a grid of
 * 8 columns of 44 px buttons. This file imports the data of every emoji, so only EmojiLazy loads it, at the first open (never in the first
 * load of the app). Once loaded it needs no network. The device draws the emoji: there is no font or image of emoji.
 */
type GroupKey = 'people' | 'nature' | 'food' | 'activities' | 'travel' | 'objects' | 'symbols' | 'flags';
const GROUPS = data.groups as unknown as { key: GroupKey; items: EmojiItem[] }[];
/** The icon of each group button: an emoji of the group, as the mockup shows. */
const GROUP_ICON: Record<GroupKey, string> = { people: '😀', nature: '🐱', food: '🍔', activities: '⚽', travel: '🚗', objects: '💡', symbols: '❤️', flags: '🏳️' };
/** The hand that shows each choice of the skin tone: default, then light to dark. */
const TONE_SAMPLES = ['👋', '👋🏻', '👋🏼', '👋🏽', '👋🏾', '👋🏿'];
const TONES: Tone[] = [0, 1, 2, 3, 4, 5];
const COLUMNS = 8;

let byEmoji: Map<string, EmojiItem> | undefined;
/** The item of an emoji, also of a form with a skin tone, for the name of a button in Recent. */
function itemOf(emoji: string): EmojiItem | undefined {
  if (!byEmoji) {
    byEmoji = new Map();
    for (const group of GROUPS) {
      for (const item of group.items) {
        byEmoji.set(item.e, item);
        for (const form of item.s ?? []) byEmoji.set(form, item);
      }
    }
  }
  return byEmoji.get(emoji);
}

/** The place of the next button for an arrow key. A grid ends, the next grid (or the one before) takes the key. */
function nextCell(from: HTMLElement, key: string, rtl: boolean, root: HTMLElement): HTMLElement | undefined {
  const grids = [...root.querySelectorAll<HTMLElement>('[data-grid]')];
  const at = grids.findIndex((grid) => grid.contains(from));
  if (at === -1) return undefined;
  const cells = [...grids[at].querySelectorAll<HTMLElement>('[data-emoji]')];
  const index = cells.indexOf(from);
  const cellsOf = (grid: HTMLElement | undefined) => (grid ? [...grid.querySelectorAll<HTMLElement>('[data-emoji]')] : []);
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    // In Arabic the grid reads from the right, so the key toward the right goes to the cell before.
    const step = (key === 'ArrowRight') === !rtl ? 1 : -1;
    if (cells[index + step]) return cells[index + step];
    const other = cellsOf(grids[at + step]);
    return step > 0 ? other[0] : other[other.length - 1];
  }
  const column = index % COLUMNS;
  if (key === 'ArrowDown') {
    if (cells[index + COLUMNS]) return cells[index + COLUMNS];
    // A last row that is not full: the key goes to its last cell. Else the next grid takes it, in the same column.
    if (Math.floor(index / COLUMNS) < Math.floor((cells.length - 1) / COLUMNS)) return cells[cells.length - 1];
    const other = cellsOf(grids[at + 1]);
    return other[Math.min(column, other.length - 1)];
  }
  if (key === 'ArrowUp') {
    if (index - COLUMNS >= 0) return cells[index - COLUMNS];
    const other = cellsOf(grids[at - 1]);
    return other[Math.min(Math.floor((other.length - 1) / COLUMNS) * COLUMNS + column, other.length - 1)];
  }
  return undefined;
}

/**
 * The 8 groups. Smileys and people draw at once and the others at an idle moment (performance audit 2026-10-21, RN-8): a group that is
 * not drawn yet keeps its id and its height, so the group buttons and the arrow keys work. It mounts again after a search ends, so it
 * draws in stages each time.
 */
function Groups({ uid, tone, lang, tabbable, onPick }: { uid: string; tone: Tone; lang: 'en' | 'ar'; tabbable: string | null; onPick: (emoji: string) => void }) {
  const { t } = useTranslation();
  const drawn = useStaged(GROUPS.length, 1);
  return (
    <>
      {GROUPS.map((group, index) => (
        <EmojiGroup
          key={group.key}
          id={`${uid}-${group.key}`}
          title={t(`emoji.group.${group.key}`)}
          kind={group.key}
          items={group.items}
          filled={index < drawn}
          tone={tone}
          lang={lang}
          tabbable={tabbable?.startsWith(`${group.key}:`) ? tabbable : null}
          onPick={onPick}
        />
      ))}
    </>
  );
}

type PanelProps = { onPick: (emoji: string) => void; layout: 'panel' | 'sheet' };

export function EmojiPanel({ onPick, layout }: PanelProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const uid = useId();
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState(readRecent);
  const [tone, setTone] = useState<Tone>(readTone);
  const [toneOpen, setToneOpen] = useState(false);
  const [tabCell, setTabCell] = useState<string | null>(null);
  const nameOf = (item: EmojiItem | undefined, emoji: string) => (item ? (lang === 'ar' ? item.ar : item.en) : emoji);
  const shown = (item: EmojiItem) => (tone > 0 && item.s ? item.s[tone - 1] : item.e);
  const pick = useCallback((emoji: string) => {
    setRecent(pushRecent(emoji));
    onPick(emoji);
  }, [onPick]);
  const results = searchEmoji(GROUPS, query);
  const searching = query.trim() !== '';
  // The one cell in the tab order: the last one that had the focus, else the first cell of the panel.
  const firstId = searching ? (results[0] ? `s:${results[0].e}` : null) : `r:${recent[0]}`;
  const tabbable = tabCell ?? firstId;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const from = (event.target as HTMLElement).closest<HTMLElement>('[data-emoji]');
    if (!from || !list.current) return;
    const to = nextCell(from, event.key, document.documentElement.dir === 'rtl', list.current);
    event.preventDefault();
    if (to) {
      to.focus();
      to.scrollIntoView?.({ block: 'nearest' });
    }
  };
  const goTo = (key: GroupKey) => {
    const box = list.current;
    const target = document.getElementById(`${uid}-${key}`);
    if (!box || !target) return;
    box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top;
  };
  const grid = (label: string, kind: string, entries: { emoji: string; name: string; key: string }[]) => (
    <div role="group" aria-label={label} data-grid className="grid grid-cols-8">
      {entries.map((entry) => (
        <Cell key={entry.key} emoji={entry.emoji} name={entry.name} id={`${kind}:${entry.key}`} tabbable={tabbable === `${kind}:${entry.key}`} onPick={pick} />
      ))}
    </div>
  );
  const groupBar = (
    <div role="toolbar" aria-label={t('emoji.groups')} className="flex shrink-0 justify-between">
      {GROUPS.map((group) => (
        <button
          key={group.key}
          type="button"
          aria-label={t(`emoji.group.${group.key}`)}
          title={t(`emoji.group.${group.key}`)}
          onClick={() => goTo(group.key)}
          className="pressable grid size-11 shrink-0 place-items-center rounded-full text-xl leading-none hover:bg-fill"
        >
          <span aria-hidden>{GROUP_ICON[group.key]}</span>
        </button>
      ))}
    </div>
  );
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-2">
      <input
        type="search"
        // The search field takes the focus on a computer. On a phone it would raise the keyboard over the grid.
        autoFocus={layout === 'panel'}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            list.current?.querySelector<HTMLElement>('[data-emoji]')?.focus();
          }
        }}
        aria-label={t('emoji.search')}
        placeholder={t('emoji.search')}
        autoComplete="off"
        enterKeyHint="search"
        dir="auto"
        className="field shrink-0"
      />
      {!searching && layout === 'panel' && groupBar}
      <div
        ref={list}
        data-vaul-no-drag
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-cell]');
          if (cell) setTabCell(cell.dataset.cell ?? null);
        }}
        className={`min-h-24 shrink overflow-y-auto overscroll-contain ${layout === 'panel' ? 'h-72' : '-mx-1 h-[min(26rem,48dvh)]'}`}
      >
        {searching ? (
          results.length === 0 ? (
            <p role="status" className="px-1 py-8 text-center text-subheadline text-label-2">{t('emoji.none')}</p>
          ) : (
            grid(t('emoji.search'), 's', results.map((item) => ({ emoji: shown(item), name: nameOf(item, item.e), key: item.e })))
          )
        ) : (
          <>
            <section aria-labelledby={`${uid}-recent`}>
              <h3 id={`${uid}-recent`} className="px-1 pb-1 text-footnote font-semibold text-ink-2">{t('emoji.recent')}</h3>
              {grid(t('emoji.recent'), 'r', recent.map((emoji) => ({ emoji, name: nameOf(itemOf(emoji), emoji), key: emoji })))}
            </section>
            <Groups uid={uid} tone={tone} lang={lang} tabbable={tabbable} onPick={pick} />
          </>
        )}
      </div>
      {/* The sheet of a phone keeps the group row under the grid, in reach of the thumb. It hides while a search text is typed. */}
      {!searching && layout === 'sheet' && groupBar}
      <div className="flex shrink-0 flex-col gap-1 border-t border-hairline pt-2">
        <button
          type="button"
          aria-expanded={toneOpen}
          onClick={() => setToneOpen((open) => !open)}
          className="pressable flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 text-start text-subheadline hover:bg-fill"
        >
          <span>{t('emoji.skinTone')}</span>
          <span aria-hidden className="text-xl leading-none">{TONE_SAMPLES[tone]}</span>
        </button>
        {toneOpen && (
          <div role="radiogroup" aria-label={t('emoji.skinTone')} className="flex justify-between">
            {TONES.map((choice) => (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={tone === choice}
                aria-label={t(`emoji.tone.${choice}`)}
                title={t(`emoji.tone.${choice}`)}
                onClick={() => {
                  setTone(choice);
                  writeTone(choice);
                  setToneOpen(false);
                }}
                className={`pressable grid size-11 shrink-0 place-items-center rounded-full text-xl leading-none ${tone === choice ? 'bg-fill-strong ring-1 ring-inset ring-accent' : 'hover:bg-fill'}`}
              >
                <span aria-hidden>{TONE_SAMPLES[choice]}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

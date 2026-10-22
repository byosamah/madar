import { memo, useMemo } from 'react';
import { Cell } from './EmojiCell';
import type { Tone } from './recent';
import type { EmojiItem } from './search';

const COLUMNS = 8;
/** The height of one row of cells (h-11). A group that is not drawn yet holds a box of the height of its grid. */
const ROW_PX = 44;

export type GroupProps = {
  id: string;
  title: string;
  kind: string;
  items: EmojiItem[];
  /** False until the idle step: the group then holds its heading and a box of its final height, and no cell. */
  filled: boolean;
  tone: Tone;
  lang: 'en' | 'ar';
  /** The id of the one cell in the tab order, only when that cell is in this group (else null, so the other groups keep their props). */
  tabbable: string | null;
  onPick: (emoji: string) => void;
};

/**
 * One group of the panel: its heading and its grid. Memoized (performance audit 2026-10-21, RN-8), so a move of the focus renders the
 * two groups that change and a cell press renders none. The name of each emoji is built once for a tone and a language.
 */
export const EmojiGroup = memo(function EmojiGroup({ id, title, kind, items, filled, tone, lang, tabbable, onPick }: GroupProps) {
  const entries = useMemo(
    () => (filled ? items.map((item) => ({ emoji: tone > 0 && item.s ? item.s[tone - 1]! : item.e, name: lang === 'ar' ? item.ar : item.en, key: item.e })) : []),
    [filled, items, tone, lang],
  );
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      // The browser skips the drawing of the groups out of view: the panel holds 1,900 buttons.
      style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${Math.ceil(items.length / COLUMNS) * ROW_PX + 36}px` }}
    >
      <h3 id={`${id}-title`} className="px-1 pb-1 pt-3 text-footnote font-semibold text-ink-2">{title}</h3>
      {filled ? (
        <div role="group" aria-label={title} data-grid className="grid grid-cols-8">
          {entries.map((entry) => (
            <Cell key={entry.key} emoji={entry.emoji} name={entry.name} id={`${kind}:${entry.key}`} tabbable={tabbable === `${kind}:${entry.key}`} onPick={onPick} />
          ))}
        </div>
      ) : (
        <div data-slot aria-hidden style={{ height: Math.ceil(items.length / COLUMNS) * ROW_PX }} />
      )}
    </section>
  );
});

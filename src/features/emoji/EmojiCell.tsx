import { memo } from 'react';

const CELL = 'grid h-11 w-full place-items-center rounded-xl text-2xl leading-none hover:bg-fill focus-visible:bg-fill-strong';

export type CellProps = { emoji: string; name: string; id: string; tabbable: boolean; onPick: (emoji: string) => void };
/** One button. Memoized, so a move of the focus draws two cells again and not the 1,900 of the panel. */
export const Cell = memo(function Cell({ emoji, name, id, tabbable, onPick }: CellProps) {
  return (
    <button type="button" data-emoji={emoji} data-cell={id} aria-label={name} tabIndex={tabbable ? 0 : -1} onClick={() => onPick(emoji)} className={CELL}>
      <span aria-hidden>{emoji}</span>
    </button>
  );
});

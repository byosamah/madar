import { useId, type ReactNode } from 'react';
import { useLang } from '../../app/lang';
import { formatNumber } from '../../lib/dates';

/**
 * The frame of a Dashboard card that lists what needs a look, in the pattern of the Stale projects card: a small heading with a
 * count, then a list of rows. The caller draws the card only when it has a row (owner, 2026-10-06).
 */
export function AttentionCard({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const id = useId();
  const lang = useLang();
  return (
    <section aria-labelledby={id} className="panel flex flex-col gap-1 p-5">
      <h2 id={id} className="flex items-center gap-2 pb-1 text-footnote font-semibold uppercase tracking-[0.06em] text-ink-2">
        {title}
        <span className="tabular rounded-full bg-fill px-2 text-caption font-semibold text-ink-2">{formatNumber(count, lang)}</span>
      </h2>
      <ul className="hairline flex flex-col">{children}</ul>
    </section>
  );
}

/** One row of an attention card: the row is the link (or button), the text sits in the middle, and an optional sign at the end. */
export const ROW = 'pressable flex min-h-14 w-full items-center gap-3 py-2 text-start hover:bg-fill/50';

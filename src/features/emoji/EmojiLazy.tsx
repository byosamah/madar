import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The emoji panel, loaded at the first open (chat presence design D8). The panel file holds the data of every emoji, so nothing in the
 * first load of the app may import it with a plain import: only this file, with import(). The wait is one quiet line.
 */
const Panel = lazy(() => import('./EmojiPanel').then((module) => ({ default: module.EmojiPanel })));

export function EmojiLazy({ onPick, layout }: { onPick: (emoji: string) => void; layout: 'panel' | 'sheet' }) {
  const { t } = useTranslation();
  return (
    <Suspense fallback={<p role="status" className="py-12 text-center text-subheadline text-label-2">{t('emoji.wait')}</p>}>
      <Panel onPick={onPick} layout={layout} />
    </Suspense>
  );
}

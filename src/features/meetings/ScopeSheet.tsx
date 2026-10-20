import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';

export type Scope = 'one' | 'later';

/**
 * The question before a change or a cancel of a meeting that repeats (fbk_022, wave 3, owner 2026-10-19): "This meeting" or "This and
 * later meetings". Two plain buttons and nothing else. The focus is on the lesser choice, "This meeting". A new day cannot apply to
 * the later meetings, so the form turns the second button off and says why (`laterDisabled`). The Close button and the Escape key
 * leave the meeting as it is.
 */
export function ScopeSheet({ mode, laterDisabled = false, onPick, onClose }: {
  mode: 'edit' | 'cancel'; laterDisabled?: boolean; onPick: (scope: Scope) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const variant = mode === 'cancel' ? 'destructive' : 'secondary';
  return (
    <Sheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t(`series.scope.${mode}Title`)}
      footer={(
        <>
          <Button variant={variant} autoFocus data-autofocus onClick={() => onPick('one')}>{t('series.scope.one')}</Button>
          <Button variant={variant} disabled={laterDisabled} onClick={() => onPick('later')}>{t('series.scope.later')}</Button>
        </>
      )}
    >
      <p className="pt-1 text-body text-ink">{t(`series.scope.${mode}Body`)}</p>
      {laterDisabled && <p className="pt-2 text-footnote text-ink-2">{t('series.scope.dayNote')}</p>}
    </Sheet>
  );
}

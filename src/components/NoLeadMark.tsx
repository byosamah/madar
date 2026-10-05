import { useTranslation } from 'react-i18next';

/**
 * The mark of a task with no lead (owner, 2026-10-05): an empty dashed circle where the lead's picture goes, at the same size.
 * It is quiet on purpose: a missing lead is a gap to fill, not an error. The ink-2 line keeps at least 3:1 on the card in both
 * themes, because the mark carries meaning (label-3 gave about 2.6:1).
 */
export function NoLeadMark({ size = 32 }: { size?: number }) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t('lead.noLead')}
      title={t('lead.noLead')}
      style={{ width: size, height: size }}
      className="inline-block shrink-0 rounded-full border-[1.5px] border-dashed border-ink-2"
    />
  );
}

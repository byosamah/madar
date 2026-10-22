import { useTranslation } from 'react-i18next';

/**
 * A small lock beside the name of a hidden project (fbk_044, owner 2026-10-22). The words "Only the team and chosen people" are its
 * label for a screen reader and its title on hover. It is no control and holds no focus.
 */
export function HiddenMark({ size = 14, className = '' }: { size?: number; className?: string }) {
  const { t } = useTranslation();
  const label = t('project.hiddenMark');
  return (
    <span role="img" aria-label={label} title={label} className={`inline-flex shrink-0 align-middle text-ink-2 ${className}`}>
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    </span>
  );
}

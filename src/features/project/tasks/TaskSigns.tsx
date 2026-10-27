import { useTranslation } from 'react-i18next';
import { StatusSign } from '../../../components/StatusSign';
import type { When } from '../../../lib/due';

/** The start or due words of a to-do line. A past due date gets the late sign; any other word is plain text. */
export function DueSign({ when }: { when: When }) {
  return when.late ? <StatusSign state="late" wrap>{when.text}</StatusSign> : <span className="tabular">{when.text}</span>;
}

/** "v2" from version 2 on. A row that must not shrink passes `shrink-0` as `className`. */
export function VersionBadge({ version, className }: { version: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <span title={t('tasks.versionLabel', { n: version })} className={`tabular${className ? ` ${className}` : ''} rounded-full bg-fill px-1.5 text-caption font-semibold text-ink-2`}>
      <span aria-hidden>{t('tasks.versionBadge', { n: version })}</span>
      <span className="sr-only">{t('tasks.versionLabel', { n: version })}</span>
    </span>
  );
}

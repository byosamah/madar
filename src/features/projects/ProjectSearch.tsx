import { useTranslation } from 'react-i18next';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { SearchIcon } from '../../components/icons/animated/search';

/**
 * The search field over the project list of a phone. It uses the `field` class (17 px, so Safari on iPhone does not zoom) and is 44 px
 * high. The text lives in the parent, not in the link, and it does not count in the Filter badge.
 */
export function ProjectSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="relative min-w-0 flex-1">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 start-3 grid place-items-center text-ink-2">
        <AnimatedIcon icon={SearchIcon} size={16} aria-hidden />
      </span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={t('phoneWork.projects.search')}
        placeholder={t('phoneWork.projects.search')}
        enterKeyHint="search"
        autoComplete="off"
        className="field ps-9"
      />
    </div>
  );
}

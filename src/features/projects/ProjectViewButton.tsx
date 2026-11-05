import { useTranslation } from 'react-i18next';
import { useIsPhone } from '../../app/useIsPhone';
import { FilterButton } from '../../components/FilterButton';
import { LayoutGridIcon } from '../../components/icons/animated/layout-grid';
import { PROJECT_VIEWS, type ProjectView } from './projectView';
import { ProjectViewToggle } from './ProjectViewToggle';

const RADIO = 'flex min-h-11 items-center gap-3 text-body text-ink';

/**
 * The View control of the Projects page (fbk_080). On a desk it is a small button beside Filter that opens Rows or Boxes as radios, the
 * same way as the view button of Tasks. On a phone it is the round toggle.
 */
export function ProjectViewButton({ view, onView }: { view: ProjectView; onView: (next: ProjectView) => void }) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  if (phone) return <ProjectViewToggle view={view} onView={onView} />;
  return (
    <FilterButton label={t('projectView.label')} count={0} icon={LayoutGridIcon}>
      <fieldset className="flex flex-col">
        <legend className="sr-only">{t('projectView.label')}</legend>
        {PROJECT_VIEWS.map((value) => (
          <label key={value} className={RADIO}>
            <input type="radio" name="project-view" checked={view === value} onChange={() => onView(value)} className="size-5 accent-[var(--sig-from)]" />
            {t(`projectView.${value}`)}
          </label>
        ))}
      </fieldset>
    </FilterButton>
  );
}

import { useTranslation } from 'react-i18next';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { LayoutGridIcon } from '../../components/icons/animated/layout-grid';
import type { ProjectView } from './projectView';

/**
 * One round toggle of 44 px (fbk_080): a press switches Rows and Boxes, with no sheet and no radio. The grid icon shows in both states,
 * and the Boxes state has the stronger fill with a ring (`aria-pressed`). A phone Projects page and a desk Home use it. It lives in its own file: Home is a first-load screen, and `FilterButton` would pull the sheet drawer into the first load.
 */
export function ProjectViewToggle({ view, onView, className = '' }: { view: ProjectView; onView: (next: ProjectView) => void; className?: string }) {
  const { t } = useTranslation();
  const boxes = view === 'boxes';
  return (
    <button
      type="button"
      aria-pressed={boxes}
      aria-label={t('projectView.showBoxes')}
      onClick={() => onView(boxes ? 'rows' : 'boxes')}
      className={`pressable grid size-11 shrink-0 place-items-center rounded-full text-ink ${boxes ? 'bg-fill-strong ring-1 ring-ink' : 'bg-fill'} ${className}`}
    >
      <AnimatedIcon icon={LayoutGridIcon} size={18} aria-hidden />
    </button>
  );
}

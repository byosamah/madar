import { useTranslation } from 'react-i18next';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { LayoutGridIcon } from '../../components/icons/animated/layout-grid';
import type { ProjectView } from './projectView';

/**
 * One round toggle (fbk_080): a press switches Rows and Boxes, with no sheet and no radio. The grid icon shows in both states, and the
 * Boxes state has the stronger fill with a ring (`aria-pressed`). A phone Projects page and a desk Home use it. It lives in its own file:
 * Home is a first-load screen, and `FilterButton` would pull the sheet drawer into the first load.
 * `size` "default" is the 44 px disc of the phone. `size` "quiet" (fbk_082, the desk Home only) is a 32 px disc with a 16 px icon in the
 * secondary ink, and an `after:` strip that keeps the press area at 44 px (the same way as `Switch`).
 */
export function ProjectViewToggle({ view, onView, size = 'default', className = '' }: { view: ProjectView; onView: (next: ProjectView) => void; size?: 'default' | 'quiet'; className?: string }) {
  const { t } = useTranslation();
  const boxes = view === 'boxes';
  const quiet = size === 'quiet';
  const label = t('projectView.showBoxes');
  return (
    <button
      type="button"
      aria-pressed={boxes}
      aria-label={label}
      title={label}
      onClick={() => onView(boxes ? 'rows' : 'boxes')}
      className={`pressable grid shrink-0 place-items-center rounded-full ${quiet ? "relative size-8 text-ink-2 after:absolute after:-inset-1.5 after:content-['']" : 'size-11 text-ink'} ${boxes ? 'bg-fill-strong ring-1 ring-ink' : 'bg-fill'} ${className}`}
    >
      <AnimatedIcon icon={LayoutGridIcon} size={quiet ? 16 : 18} aria-hidden />
    </button>
  );
}

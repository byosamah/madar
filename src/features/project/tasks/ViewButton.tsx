import { useTranslation } from 'react-i18next';
import { AnimatedIcon } from '../../../components/icons/AnimatedIcon';
import { FolderKanbanIcon } from '../../../components/icons/animated/folder-kanban';

/**
 * The View button of the To-dos tab on a phone (phone D). It has the look of the Filter button and names the view that shows now.
 * One press switches between the list and the board, so the choice needs no sheet.
 */
export function ViewButton({ view, onView }: { view: 'list' | 'board'; onView: (next: 'list' | 'board') => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => onView(view === 'list' ? 'board' : 'list')}
      className="pressable panel inline-flex min-h-11 items-center gap-2 !rounded-full px-4 text-subheadline font-semibold text-ink transition-colors hover:!bg-fill"
    >
      <AnimatedIcon icon={FolderKanbanIcon} size={16} aria-hidden />
      {t('phoneProject.tasks.view', { view: t(`tasks.views.${view}`) })}
    </button>
  );
}

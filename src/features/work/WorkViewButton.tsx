import { useTranslation } from 'react-i18next';
import { useIsPhone } from '../../app/useIsPhone';
import { FilterButton } from '../../components/FilterButton';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { FolderKanbanIcon } from '../../components/icons/animated/folder-kanban';
import { WORK_VIEWS, type WorkView } from './workView';

const RADIO = 'flex min-h-11 items-center gap-3 text-body text-ink';

/**
 * The one small button at the end of the To-dos and Meetings row (fbk_042, owner 2026-10-22). On a desk it opens List or Board in the same
 * choice box and with the same radio look as the view choice of the project To-dos tab. On a phone (phone design D) it is one round
 * toggle of 44 px: a press switches List and Board, with no sheet and no radio. The kanban icon shows in both states, and the Board
 * state has the stronger fill with a ring (`aria-pressed`). It shows only in the To-dos view.
 */
export function WorkViewButton({ view, onView, onPrepare }: { view: WorkView; onView: (next: WorkView) => void; onPrepare?: () => void }) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  if (phone) {
    const board = view === 'board';
    return (
      <button
        type="button"
        aria-pressed={board}
        aria-label={t('tasks.views.board')}
        onPointerDown={onPrepare}
        onClick={() => onView(board ? 'list' : 'board')}
        className={`pressable grid size-11 shrink-0 place-items-center rounded-full text-ink ${board ? 'bg-fill-strong ring-1 ring-ink' : 'bg-fill'}`}
      >
        <AnimatedIcon icon={FolderKanbanIcon} size={18} aria-hidden />
      </button>
    );
  }
  return (
    <div className="ms-auto" onPointerDown={onPrepare}>
      <FilterButton label={t('workView.label')} count={0} icon={FolderKanbanIcon}>
        <fieldset className="flex flex-col">
          <legend className="sr-only">{t('workView.label')}</legend>
          {WORK_VIEWS.map((value) => (
            <label key={value} className={RADIO}>
              <input type="radio" name="work-view" checked={view === value} onChange={() => onView(value)} className="size-5 accent-[var(--sig-from)]" />
              {t(`tasks.views.${value}`)}
            </label>
          ))}
        </fieldset>
      </FilterButton>
    </div>
  );
}

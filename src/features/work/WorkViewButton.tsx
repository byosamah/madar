import { useTranslation } from 'react-i18next';
import { FilterButton } from '../../components/FilterButton';
import { FolderKanbanIcon } from '../../components/icons/animated/folder-kanban';
import { WORK_VIEWS, type WorkView } from './workView';

const RADIO = 'flex min-h-11 items-center gap-3 text-body text-ink';

/**
 * The one small button at the end of the To-dos and Meetings row (fbk_042, owner 2026-10-22). It opens List or Board in the same
 * choice box and with the same radio look as the view choice of the project To-dos tab. It shows only in the To-dos view.
 */
export function WorkViewButton({ view, onView, onPrepare }: { view: WorkView; onView: (next: WorkView) => void; onPrepare?: () => void }) {
  const { t } = useTranslation();
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

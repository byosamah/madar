import { useTranslation } from 'react-i18next';
import { ScreenTitle } from '../../components/ScreenTitle';
import { WorkTasks } from './WorkTasks';

/** My tasks from all projects (spec 6). The office keeps no hours, so there is no timesheet (owner, 2026-10-01). */
export function WorkScreen() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <ScreenTitle title={t('screens.myWork')} />
      <WorkTasks />
    </div>
  );
}

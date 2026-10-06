import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../components/icons/animated/plus';
import { ScreenTitle } from '../../components/ScreenTitle';
import { NewOfficeTaskSheet } from './NewOfficeTaskSheet';
import { WorkTasks } from './WorkTasks';

/**
 * My tasks from all projects and the office (spec 6). The office keeps no hours, so there is no timesheet (owner, 2026-10-01).
 * The one main button adds an office task, a task of no project (owner, 2026-10-06).
 */
export function WorkScreen() {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <ScreenTitle
        title={t('screens.myWork')}
        action={(
          <Button variant="primary" className="shrink-0" onClick={() => setAdding(true)}>
            <AnimatedIcon icon={PlusIcon} size={18} aria-hidden />
            {t('office.new')}
          </Button>
        )}
      />
      <WorkTasks />
      <NewOfficeTaskSheet open={adding} onOpenChange={setAdding} />
    </div>
  );
}

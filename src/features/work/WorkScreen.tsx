import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../components/icons/animated/plus';
import { ScreenControls } from '../../components/ScreenControls';
import { ScreenTitle } from '../../components/ScreenTitle';
import { useRight } from '../../app/useRight';
import { NewOfficeTaskSheet } from './NewOfficeTaskSheet';
import { WorkSwitch } from './WorkSwitch';
import { WorkTasks } from './WorkTasks';

/**
 * My tasks from all projects and the office (spec 6). The office keeps no hours, so there is no timesheet (owner, 2026-10-01).
 * The one main button adds an office task, a task of no project (owner, 2026-10-06). The To-dos and Meetings switch sits in its own row
 * under the title, as the Filter button does on Projects (owner, 2026-10-23).
 */
export function WorkScreen() {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  // "New office to-do" needs the office switch of task.add (role rights version 2).
  const mayAdd = useRight('task.add', { office: true });
  return (
    <div className="flex flex-col">
      <ScreenTitle
        title={t('screens.myWork')}
        action={mayAdd ? (
          <Button variant="primary" className="shrink-0" onClick={() => setAdding(true)}>
            <AnimatedIcon icon={PlusIcon} size={18} aria-hidden />
            {t('office.new')}
          </Button>
        ) : undefined}
      />
      <ScreenControls>
        <WorkSwitch />
      </ScreenControls>
      <WorkTasks />
      {mayAdd && <NewOfficeTaskSheet open={adding} onOpenChange={setAdding} />}
    </div>
  );
}

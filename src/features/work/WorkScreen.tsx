import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { AnimatedIcon } from '../../components/icons/AnimatedIcon';
import { PlusIcon } from '../../components/icons/animated/plus';
import { ScreenControls } from '../../components/ScreenControls';
import { ScreenTitle } from '../../components/ScreenTitle';
import { usePersistentChoice } from '../../app/choices';
import { usePrefetchCall } from '../../app/prefetch';
import { useRight } from '../../app/useRight';
import { whenIdle } from '../../app/whenIdle';
import { todayISO } from '../../lib/dates';
import { doneWindow } from './boardRows';
import { NewOfficeTaskSheet } from './NewOfficeTaskSheet';
import { WorkSwitch } from './WorkSwitch';
import { lazyWorkBoard } from './WorkBoardLazy';
import { WorkTasks } from './WorkTasks';
import { WorkViewButton } from './WorkViewButton';
import { WORK_VIEW_KEY, WORK_VIEWS } from './workView';

/**
 * My tasks from all projects and the office (spec 6). The office keeps no hours, so there is no timesheet (owner, 2026-10-01).
 * The one main button adds an office task, a task of no project (owner, 2026-10-06). The To-dos and Meetings switch sits in its own row
 * under the title, as the Filter button does on Projects (owner, 2026-10-23). The small View button at the end of that row, in the To-dos view
 * only, picks List or Board (fbk_042, owner 2026-10-22). The choice stays on this device.
 */
export function WorkScreen() {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  // "New office to-do" needs the office switch of task.add (role rights version 2).
  const mayAdd = useRight('task.add', { office: true });
  const [view, setView] = usePersistentChoice(WORK_VIEW_KEY, WORK_VIEWS, 'list');
  // The code of the Board loads at idle, and a press on the View button starts the done read, so a switch to Board finds both ready.
  useEffect(() => {
    whenIdle(lazyWorkBoard.warm);
  }, []);
  const prefetch = usePrefetchCall();
  const today = todayISO();
  const donePlan = useMemo(() => doneWindow(today), [today]);
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
        <WorkViewButton
          view={view}
          onView={(next) => {
            if (next === 'board') lazyWorkBoard.warm();
            setView(next);
          }}
          onPrepare={view === 'list' ? () => { lazyWorkBoard.warm(); prefetch('tasks.list', donePlan); } : undefined}
        />
      </ScreenControls>
      <WorkTasks view={view} />
      {mayAdd && <NewOfficeTaskSheet open={adding} onOpenChange={setAdding} />}
    </div>
  );
}

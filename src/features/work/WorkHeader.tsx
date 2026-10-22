import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { rememberWorkView } from '../../app/lastList';
import { useIsPhone } from '../../app/useIsPhone';
import { ScreenControls } from '../../components/ScreenControls';
import { ScreenTitle } from '../../components/ScreenTitle';
import { WorkSwitch } from './WorkSwitch';

const VIEWS = ['/work', '/meetings', '/projects'] as const;

/**
 * The top of the three Work views (phone design D): To-dos, Meetings and Projects. Each view draws its own header with its own main
 * button, so each screen keeps the state of its own sheet.
 * - A phone gets the title "Work", the main button of the view at its end, and one row under it: the full-width switch and, in the To-dos
 *   view, the View toggle (`trailing`).
 * - A desk gets what it had: the title "Tasks" with the switch and the View button in the row under it.
 * The header also tells the tab bar which view the person used last (`rememberWorkView`). On a phone it moves the focus to the checked part of
 * the switch after a keyboard change of view: the route change mounts a new header, and the focus would be lost. The desk keeps its way.
 */
export function WorkHeader({ action, trailing }: { action?: ReactNode; trailing?: ReactNode }) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const { pathname, state } = useLocation();
  const row = useRef<HTMLDivElement>(null);
  const view = VIEWS.find((path) => path === pathname);
  useLayoutEffect(() => {
    if (view) rememberWorkView(view);
  }, [view]);
  const focusSwitch = phone && Boolean((state as { focusSwitch?: boolean } | null)?.focusSwitch);
  useLayoutEffect(() => {
    if (focusSwitch) row.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus({ preventScroll: true });
    // Only the mount reads the state: the header of the new view mounts with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!phone) {
    return (
      <>
        <ScreenTitle title={t('screens.myWork')} action={action} />
        <ScreenControls>
          <WorkSwitch />
          {trailing}
        </ScreenControls>
      </>
    );
  }
  return (
    <>
      <ScreenTitle title={t('phoneWork.title')} action={action} />
      <div ref={row} className="flex items-center gap-3 pb-4">
        <div className="min-w-0 flex-1">
          <WorkSwitch />
        </div>
        {trailing}
      </div>
    </>
  );
}

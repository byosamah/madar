import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { rememberWorkView } from '../../app/lastList';
import { useIsPhone } from '../../app/useIsPhone';
import { ScreenControls } from '../../components/ScreenControls';
import { ScreenTitle } from '../../components/ScreenTitle';
import { WorkSwitch } from './WorkSwitch';

const VIEWS = ['/work', '/meetings', '/projects', '/resources'] as const;

/**
 * The top of the Work views (phone design D): To-dos, Meetings, Projects and, on a phone, Resources (fbk_078). Each view draws its own header with its own main
 * button, so each screen keeps the state of its own sheet.
 * - A phone gets the title "Work" and, at the end of the title row, the View toggle (`trailing`, To-dos view only) first and then the main
 *   button of the view, with a small gap. Under the title, the switch has the whole row: with four parts, a toggle beside it cut the labels
 *   at 360 px. The To-dos main button has a 16 px side padding on a phone (`WorkScreen`), so the Arabic title row fits at 360 px.
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
  const end = trailing || action ? (
    <div className="flex shrink-0 items-center gap-1.5">
      {trailing}
      {action}
    </div>
  ) : undefined;
  return (
    <>
      <ScreenTitle title={t('phoneWork.title')} action={end} />
      <div ref={row} className="pb-4">
        <WorkSwitch />
      </div>
    </>
  );
}

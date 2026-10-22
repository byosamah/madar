import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { usePressReads } from '../../app/pressReads';
import { usePrefetchCall } from '../../app/prefetch';
import { useIsPhone } from '../../app/useIsPhone';
import { SegmentedControl } from '../../components/SegmentedControl';

type Part = 'tasks' | 'meetings' | 'projects';
const PATH: Record<Part, string> = { tasks: '/work', meetings: '/meetings', projects: '/projects' };

/**
 * The switch under the title of Work (fbk_022, owner 2026-10-19; phone design D, 2026-10-22). On a desk: "Tasks" and "Meetings", two views
 * of one tab. On a phone: "To-dos", "Meetings" and "Projects", three equal parts over the full width, with a thumb that slides across the
 * change of view (the `layoutId` is fixed, so the new header takes the thumb of the old one). The switch reads the address, so a link to
 * /meetings opens the second view. A press on a part starts the reads of its view before the click ends (`usePressReads`).
 */
export function WorkSwitch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const phone = useIsPhone();
  const pressReads = usePressReads();
  const prefetch = usePrefetchCall();
  const value: Part = pathname === '/meetings' ? 'meetings' : phone && pathname.startsWith('/projects') ? 'projects' : 'tasks';
  const options: { value: Part; label: string }[] = [
    { value: 'tasks', label: t('meetings.switch.todos') },
    { value: 'meetings', label: t('meetings.switch.meetings') },
    ...(phone ? [{ value: 'projects' as const, label: t('screens.projects') }] : []),
  ];
  return (
    <SegmentedControl
      label={t('meetings.switch.label')}
      value={value}
      options={options}
      // The route change mounts a new header. It reads this state and puts the focus on the new part (WorkHeader).
      onChange={(next) => navigate(PATH[next], { state: { focusSwitch: true } })}
      {...(phone ? {
        fill: true,
        layoutId: 'work-switch',
        onOptionPointerDown: (next: Part) => {
          if (next === 'tasks') return;
          pressReads(PATH[next]);
          if (next === 'meetings') prefetch('google.status', {});
        },
      } : {})}
    />
  );
}

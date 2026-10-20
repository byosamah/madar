import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { SegmentedControl } from '../../components/SegmentedControl';

/**
 * The switch under the title of Tasks (fbk_022, owner 2026-10-19): "Tasks" and "Meetings" are two views of one tab. The Tasks tab
 * stays open on both, so the tab bar keeps its five tabs. The switch reads the address, so a link to /meetings opens the second view.
 */
export function WorkSwitch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const value = pathname === '/meetings' ? 'meetings' : 'tasks';
  return (
    <SegmentedControl
      label={t('meetings.switch.label')}
      value={value}
      options={[{ value: 'tasks', label: t('meetings.switch.todos') }, { value: 'meetings', label: t('meetings.switch.meetings') }]}
      onChange={(next) => navigate(next === 'meetings' ? '/meetings' : '/work')}
    />
  );
}

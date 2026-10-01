import { useTranslation } from 'react-i18next';
import { useCall } from '../../../app/runtime';
import { EmptyState } from '../../../components/EmptyState';
import { ScreenTitle } from '../../../components/ScreenTitle';
import { OfficeSection } from './OfficeSection';
import { PeopleSection } from './PeopleSection';
import { StageTemplatesSection } from './StageTemplatesSection';
import { TaskTemplatesSection } from './TaskTemplatesSection';
import { FeedbackSection } from './FeedbackSection';

/**
 * The Admin page (owner, 2026-10-01): the people of the office and the office settings, apart from personal Settings.
 * The Admin sees all of it. Management sees the People section only. The API refuses these changes for everyone else too.
 */
export function AdminScreen() {
  const { t } = useTranslation();
  const session = useCall('session.get', {});
  if (!session.data) return null;
  const role = session.data.authority.systemRole;
  if (role !== 'admin' && role !== 'management') {
    return (
      <>
        <ScreenTitle title={t('admin.title')} />
        <EmptyState title={t('admin.title')} body={t('admin.onlyAdmin')} />
      </>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <ScreenTitle title={t('admin.title')}>{t('admin.subtitle')}</ScreenTitle>
      <PeopleSection />
      {/* Management makes and changes people. The office settings and the templates stay with the Admin. */}
      {role === 'admin' && <OfficeSection />}
      {role === 'admin' && <StageTemplatesSection />}
      {role === 'admin' && <TaskTemplatesSection />}
      {role === 'admin' && <FeedbackSection />}
    </div>
  );
}

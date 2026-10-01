import { useTranslation } from 'react-i18next';
import { useCall } from '../../../app/runtime';
import { EmptyState } from '../../../components/EmptyState';
import { ScreenTitle } from '../../../components/ScreenTitle';
import { OfficeSection } from './OfficeSection';
import { PeopleSection } from './PeopleSection';
import { StageTemplatesSection } from './StageTemplatesSection';

/**
 * The Admin page (owner, 2026-10-01): the people of the office and the office settings, apart from personal Settings.
 * Only the Admin sees it; the API refuses these changes for everyone else too.
 */
export function AdminScreen() {
  const { t } = useTranslation();
  const session = useCall('session.get', {});
  if (!session.data) return null;
  if (session.data.authority.systemRole !== 'admin') {
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
      <OfficeSection />
      <StageTemplatesSection />
    </div>
  );
}

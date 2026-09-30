import { useTranslation } from 'react-i18next';
import { useCall } from './runtime';

/** Spec 11.6: with no browser storage, the app runs in memory and says so. */
export function StorageBanner() {
  const { t } = useTranslation();
  const persistent = useCall('session.get', {}).data?.persistent;
  if (persistent !== false) return null;
  return (
    <div role="status" className="bg-fill px-4 py-2 text-center text-footnote text-label">
      {t('storage.notSaved')}
    </div>
  );
}

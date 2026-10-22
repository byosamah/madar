import { useTranslation } from 'react-i18next';
import { ScreenTitle } from '../../components/ScreenTitle';

/**
 * The Me tab of a phone (Direction D): the hub that replaces the Settings page and the person menu. A desk never mounts it: the
 * route sends it to /settings (routes.tsx). It has no main button.
 */
export function MeScreen() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <ScreenTitle title={t('phoneMe.title')} />
    </div>
  );
}

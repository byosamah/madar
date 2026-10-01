import { useTranslation } from 'react-i18next';
import { ScreenTitle } from '../../components/ScreenTitle';

export function HomeScreen() {
  const { t } = useTranslation();
  return <ScreenTitle title={t('screens.home')} />;
}

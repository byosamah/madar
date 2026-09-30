import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { ScreenTitle } from '../../components/ScreenTitle';

/** Stands in for a screen that a later plan builds. */
export function Placeholder({ titleKey, step }: { titleKey: string; step: number }) {
  const { t } = useTranslation();
  return (
    <>
      <ScreenTitle title={t(titleKey)} />
      <EmptyState title={t('placeholder.title')} body={t('placeholder.body', { step })} />
    </>
  );
}

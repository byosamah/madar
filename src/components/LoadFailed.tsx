import { useTranslation } from 'react-i18next';
import { errorMessage } from '../app/errors';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

/** A part of a screen whose data did not load: the reason and a Retry (spec 11.6), never a blank space. */
export function LoadFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  return <EmptyState title={t('common.loadFailed')} body={errorMessage(error, t)} action={<Button onClick={onRetry}>{t('common.retry')}</Button>} />;
}

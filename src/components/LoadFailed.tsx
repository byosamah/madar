import { useTranslation } from 'react-i18next';
import { errorMessage } from '../app/errors';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

type Query = { error: unknown; data: unknown; refetch: () => unknown };

/**
 * A part of a screen whose data did not load: the reason and a Retry (spec 11.6), never a blank space. Given a query, it shows
 * only when the query failed and holds no data, so a failed refresh keeps the list it already has (audit 2026-10-03, PRJ-1).
 */
export function LoadFailed(props: { error: unknown; onRetry: () => void } | { query: Query }) {
  const { t } = useTranslation();
  if ('query' in props && (!props.query.error || props.query.data !== undefined)) return null;
  const [error, onRetry] = 'query' in props ? [props.query.error, () => void props.query.refetch()] : [props.error, props.onRetry];
  return <EmptyState title={t('common.loadFailed')} body={errorMessage(error, t)} action={<Button onClick={onRetry}>{t('common.retry')}</Button>} />;
}

import type { TFunction } from 'i18next';
import { ApiError } from '../api/errors';

export function errorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.details.reason === 'week_locked') return t('errors.week_locked');
    return t(`errors.${error.code}`);
  }
  return t('errors.failed');
}

/** Only a failed call is worth a retry. A refusal or an invalid field stays the same on a retry. */
export function canRetry(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'failed';
}

import type { TFunction } from 'i18next';
import i18n from 'i18next';
import { ApiError } from '../api/errors';

export function errorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    const reason = error.details.reason;
    if (reason === 'week_locked') return t('errors.week_locked');
    // A refusal with a reason gets its own sentence, so a person learns the rule, not only that something failed.
    if (typeof reason === 'string' && i18n.exists(`errors.reasons.${reason}`)) return t(`errors.reasons.${reason}`);
    return t(`errors.${error.code}`);
  }
  return t('errors.failed');
}

/** Only a failed call is worth a retry. A refusal or an invalid field stays the same on a retry. */
export function canRetry(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'failed';
}

/** The inline message for one field of a refused form (spec 11.6), or undefined when the refusal does not name it. */
export function fieldError(error: unknown, field: string, t: TFunction, fallback: string): string | undefined {
  if (!(error instanceof ApiError) || error.code !== 'invalid_input') return undefined;
  const fields = Array.isArray(error.details.fields) ? (error.details.fields as string[]) : [];
  const hit = fields.some((path) => path === field || path.startsWith(`${field}.`) || path.endsWith(`.${field}`) || path.includes(`.${field}.`));
  if (!hit) return undefined;
  const reason = error.details.reason;
  return typeof reason === 'string' && i18n.exists(`errors.reasons.${reason}`) ? t(`errors.reasons.${reason}`) : fallback;
}

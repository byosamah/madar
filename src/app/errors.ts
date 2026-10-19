import type { TFunction } from 'i18next';
import i18n from 'i18next';
import { ApiError } from '../api/errors';

export function errorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    const reason = error.details.reason;
    if (reason === 'week_locked') return t('errors.week_locked');
    // A refusal with a reason gets its own sentence, so a person learns the rule, not only that something failed.
    // A refusal may name what is in the way (the tasks or stages that are still open), so the sentence can say it.
    const names = typeof error.details.names === 'string' ? error.details.names : '';
    // A refusal may count what is in the way (the projects that name a sub-company), so a sentence can have plural forms.
    const count = typeof error.details.count === 'number' ? error.details.count : undefined;
    if (typeof reason === 'string' && i18n.exists(`errors.reasons.${reason}`)) return t(`errors.reasons.${reason}`, { names, count });
    return t(`errors.${error.code}`);
  }
  return t('errors.failed');
}

/**
 * A failed call is worth a retry, and so is a call refused because the session ended: a 401 never ran on the server
 * (client map 7.3), so the same call is safe to send again after the person signs in. A refusal, an invalid field or a
 * turned-off account stays the same on a retry.
 */
export function canRetry(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.code === 'failed' || (error.code === 'unauthenticated' && error.details.reason !== 'account_off');
}

/** The inline message for one field of a refused form (spec 11.6), or undefined when the refusal does not name it. */
export function fieldError(error: unknown, field: string, t: TFunction, fallback: string): string | undefined {
  if (!(error instanceof ApiError) || error.code !== 'invalid_input') return undefined;
  const fields = Array.isArray(error.details.fields) ? (error.details.fields as string[]) : [];
  const hit = fields.some((path) => path === field || path.startsWith(`${field}.`) || path.endsWith(`.${field}`) || path.includes(`.${field}.`));
  if (!hit) return undefined;
  const reason = error.details.reason;
  const names = typeof error.details.names === 'string' ? error.details.names : '';
  return typeof reason === 'string' && i18n.exists(`errors.reasons.${reason}`) ? t(`errors.reasons.${reason}`, { names }) : fallback;
}

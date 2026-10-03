import type { TFunction } from 'i18next';

/**
 * Why a sign-in step failed, in words the screens can say (client map 7.1). The Supabase port (src/app/remote/auth.ts) turns
 * each Supabase error into one of these. A wrong email and a wrong password give the same reason, so a screen never tells an
 * outsider which emails have an account.
 */
export const AUTH_FAILURE_REASONS = ['wrong_credentials', 'account_off', 'link_ended', 'short', 'weak', 'same', 'too_many', 'offline', 'failed'] as const;
export type AuthFailureReason = (typeof AUTH_FAILURE_REASONS)[number];

export class AuthFailure extends Error {
  readonly reason: AuthFailureReason;

  constructor(reason: AuthFailureReason, message: string = reason) {
    super(message);
    this.name = 'AuthFailure';
    this.reason = reason;
  }
}

export function reasonOf(error: unknown): AuthFailureReason {
  return error instanceof AuthFailure ? error.reason : 'failed';
}

/** The shortest password that Madar takes. supabase/config.toml sets the same minimum_password_length. */
export const MIN_PASSWORD = 8;

/** One sentence for each reason. `ended` is the line of the screen that opened the link (Welcome or Reset). */
export function failureText(error: unknown, t: TFunction, o: { ended?: string } = {}): string {
  switch (reasonOf(error)) {
    case 'wrong_credentials': return t('auth.errors.wrong');
    case 'account_off': return t('errors.reasons.account_off');
    case 'link_ended': return o.ended ?? t('auth.errors.failed');
    case 'short': return t('auth.errors.short');
    case 'weak': return t('auth.errors.weak');
    case 'same': return t('auth.errors.same');
    case 'too_many': return t('auth.errors.tooMany');
    case 'offline': return t('auth.errors.offline');
    default: return t('auth.errors.failed');
  }
}
